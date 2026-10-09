using System;
using System.Security.Cryptography;
public class Teacher
{
    private string Name{get; set;}
    private int DateofBirth{get; set;}
    private string PhoneNumber{get; set;}
    private string Email{get; set;}
    
    private string Address{get; set;}
    public Teacher( int age,  string address, string email, string name,string phoneNumber)
    {

        if (age < 0)
        {   

            throw new ArgumentException("Age cannot be negative.");

        } else
        {
            DateofBirth = age;
        }
        
        
        This.Address = address;


        

    }
     
}



