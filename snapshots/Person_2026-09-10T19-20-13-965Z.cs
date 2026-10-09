using System;
using System.Security.Cryptography;

public class NewBaseType
{
    private string Name { get; set; }
    private int Age { get; set; }
    private string PhoneNumber { get; set; }
    private string Email { get; set; }

    private string Address { get; set; }
}


public class Teacher : NewBaseType
{
    public Teacher(   string address,int age, string email, string name,string phoneNumber)
    {

        if (age < 0)
        {   

            throw new ArgumentException("Age cannot be negative.");

        } else
        {
            Age = age;
            
        }
        
        Age = 12222;
        This.Address = address;


        

    }
     
}



