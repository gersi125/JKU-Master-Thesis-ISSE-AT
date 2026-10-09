using System;
using System.Security.Cryptography;
public class Person
{
    private string Name{get; set;}

    private int Age{get; set;}

    private string Address{get; set;}

    private string PhoneNumber{get; set;}

    private string Email{get; set;}


    
    public Person( int age, string name, string address, string phoneNumber)
    {




        this.Age = age;
        this.Name = name;
        this.Address = address;
        this.PhoneNumber = phoneNumber;

    }
     
}



