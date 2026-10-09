using System;
using System.Security.Cryptography;

public class NewBaseType
{
    private string Address { get; set; }
    private string Name { get; set; }

     public int Age { get; set; }
    private string Email { get; set; }
    private string PhoneNumber { get; set; }    
    
   
}

public class Teacher : NewBaseType
{
    public Teacher(string address, int age,string email, string name,string phoneNumber)
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



